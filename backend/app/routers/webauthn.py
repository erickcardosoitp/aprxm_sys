from __future__ import annotations

import base64
import json
from typing import Any

import webauthn
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from webauthn.helpers.structs import (
    AuthenticationCredential,
    AuthenticatorAssertionResponse,
    AuthenticatorAttestationResponse,
    AuthenticatorSelectionCriteria,
    RegistrationCredential,
    ResidentKeyRequirement,
    UserVerificationRequirement,
)

from app.config import get_settings
from app.core.security import create_access_token
from app.core.tenant import CurrentUser, get_current_user
from app.database import get_session

router = APIRouter(prefix="/auth/webauthn", tags=["WebAuthn"])


def _rp_id() -> str:
    return get_settings().webauthn_rp_id


def _origin() -> str:
    return get_settings().webauthn_origin


# ─── Registration ──────────────────────────────────────────────────────────────

@router.post("/register/begin")
async def register_begin(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    user_row = (await session.execute(
        text("SELECT email, full_name FROM users WHERE id = :id"),
        {"id": str(current.user_id)},
    )).fetchone()
    if not user_row:
        raise HTTPException(404, "Usuário não encontrado")

    existing = (await session.execute(text("""
        SELECT credential_id FROM webauthn_credentials WHERE user_id = :uid
    """), {"uid": str(current.user_id)})).fetchall()

    options = webauthn.generate_registration_options(
        rp_id=_rp_id(),
        rp_name=get_settings().webauthn_rp_name,
        user_id=str(current.user_id).encode(),
        user_name=user_row[0],
        user_display_name=user_row[1],
        authenticator_selection=AuthenticatorSelectionCriteria(
            resident_key=ResidentKeyRequirement.PREFERRED,
            user_verification=UserVerificationRequirement.PREFERRED,
        ),
        exclude_credentials=[
            webauthn.helpers.structs.PublicKeyCredentialDescriptor(
                id=base64.urlsafe_b64decode(r[0] + "==")
            )
            for r in existing
        ],
    )

    challenge_b64 = base64.urlsafe_b64encode(options.challenge).decode().rstrip("=")
    await session.execute(text("DELETE FROM webauthn_challenges WHERE user_id = :uid"), {"uid": str(current.user_id)})
    await session.execute(text("INSERT INTO webauthn_challenges (user_id, challenge) VALUES (:uid, :ch)"), {"uid": str(current.user_id), "ch": challenge_b64})
    await session.commit()

    return json.loads(webauthn.options_to_json(options))


class RegisterCompleteRequest(BaseModel):
    credential: dict[str, Any]
    device_name: str | None = None


@router.post("/register/complete")
async def register_complete(
    body: RegisterCompleteRequest,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    row = (await session.execute(text("""
        SELECT challenge FROM webauthn_challenges
        WHERE user_id = :uid AND expires_at > NOW()
        ORDER BY expires_at DESC LIMIT 1
    """), {"uid": str(current.user_id)})).fetchone()
    if not row:
        raise HTTPException(400, "Desafio expirado. Tente novamente.")

    challenge_bytes = base64.urlsafe_b64decode(row[0] + "==")

    try:
        c = body.credential
        r = c.get("response", {})
        parsed = RegistrationCredential(
            id=c["id"],
            raw_id=base64.urlsafe_b64decode(c["rawId"] + "=="),
            response=AuthenticatorAttestationResponse(
                client_data_json=base64.urlsafe_b64decode(r["clientDataJSON"] + "=="),
                attestation_object=base64.urlsafe_b64decode(r["attestationObject"] + "=="),
            ),
        )
        verification = webauthn.verify_registration_response(
            credential=parsed,
            expected_challenge=challenge_bytes,
            expected_rp_id=_rp_id(),
            expected_origin=_origin(),
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(400, f"Falha na verificação: {e}")

    cred_id_b64 = base64.urlsafe_b64encode(verification.credential_id).decode().rstrip("=")

    await session.execute(text("""
        INSERT INTO webauthn_credentials
            (user_id, association_id, credential_id, public_key, sign_count, device_name)
        VALUES (:uid, :aid, :cid, :pk, :sc, :dn)
        ON CONFLICT (credential_id) DO UPDATE SET sign_count = :sc
    """), {
        "uid": str(current.user_id),
        "aid": str(current.association_id),
        "cid": cred_id_b64,
        "pk": verification.credential_public_key,
        "sc": verification.sign_count,
        "dn": body.device_name,
    })
    await session.execute(text(
        "DELETE FROM webauthn_challenges WHERE user_id = :uid"
    ), {"uid": str(current.user_id)})
    await session.commit()

    return {"ok": True}


@router.get("/credentials")
async def list_credentials(
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> list[dict]:
    rows = (await session.execute(text("""
        SELECT id, device_name, created_at FROM webauthn_credentials
        WHERE user_id = :uid ORDER BY created_at DESC
    """), {"uid": str(current.user_id)})).fetchall()
    return [{"id": str(r[0]), "device_name": r[1], "created_at": r[2].isoformat()} for r in rows]


@router.delete("/credentials/{cred_id}")
async def delete_credential(
    cred_id: str,
    current: CurrentUser = Depends(get_current_user),
    session: AsyncSession = Depends(get_session),
) -> dict:
    await session.execute(text(
        "DELETE FROM webauthn_credentials WHERE id = :id AND user_id = :uid"
    ), {"id": cred_id, "uid": str(current.user_id)})
    await session.commit()
    return {"ok": True}


# ─── Authentication ────────────────────────────────────────────────────────────

class AuthBeginRequest(BaseModel):
    email: str
    association_id: str


@router.post("/authenticate/begin")
async def authenticate_begin(
    body: AuthBeginRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    user_row = (await session.execute(text("""
        SELECT id FROM users WHERE email = :email AND association_id = :aid AND is_active = true
    """), {"email": body.email.lower(), "aid": body.association_id})).fetchone()
    if not user_row:
        raise HTTPException(404, "Usuário não encontrado.")

    user_id = str(user_row[0])

    creds = (await session.execute(text("""
        SELECT credential_id FROM webauthn_credentials
        WHERE user_id = :uid AND association_id = :aid
    """), {"uid": user_id, "aid": body.association_id})).fetchall()

    if not creds:
        raise HTTPException(404, "Nenhum dispositivo registrado para este usuário.")

    options = webauthn.generate_authentication_options(
        rp_id=_rp_id(),
        allow_credentials=[
            webauthn.helpers.structs.PublicKeyCredentialDescriptor(
                id=base64.urlsafe_b64decode(r[0] + "==")
            )
            for r in creds
        ],
        user_verification=UserVerificationRequirement.PREFERRED,
    )

    challenge_b64 = base64.urlsafe_b64encode(options.challenge).decode().rstrip("=")
    await session.execute(text("DELETE FROM webauthn_challenges WHERE user_id = :uid"), {"uid": user_id})
    await session.execute(text("INSERT INTO webauthn_challenges (user_id, challenge) VALUES (:uid, :ch)"), {"uid": user_id, "ch": challenge_b64})
    await session.commit()

    return {**json.loads(webauthn.options_to_json(options)), "user_id": user_id}


class AuthCompleteRequest(BaseModel):
    user_id: str  # returned by begin
    association_id: str
    credential: dict[str, Any]


@router.post("/authenticate/complete")
async def authenticate_complete(
    body: AuthCompleteRequest,
    session: AsyncSession = Depends(get_session),
) -> dict:
    challenge_row = (await session.execute(text("""
        SELECT challenge FROM webauthn_challenges
        WHERE user_id = :uid AND expires_at > NOW()
        ORDER BY expires_at DESC LIMIT 1
    """), {"uid": body.user_id})).fetchone()
    if not challenge_row:
        raise HTTPException(400, "Desafio expirado. Tente novamente.")

    challenge_bytes = base64.urlsafe_b64decode(challenge_row[0] + "==")

    raw_id = body.credential.get("rawId") or body.credential.get("id", "")
    cred_id_b64 = raw_id.rstrip("=")

    cred_row = (await session.execute(text("""
        SELECT id, public_key, sign_count FROM webauthn_credentials
        WHERE credential_id = :cid AND user_id = :uid AND association_id = :aid
    """), {"cid": cred_id_b64, "uid": body.user_id, "aid": body.association_id})).fetchone()
    if not cred_row:
        raise HTTPException(400, "Dispositivo não reconhecido.")

    try:
        c = body.credential
        r = c.get("response", {})
        parsed = AuthenticationCredential(
            id=c["id"],
            raw_id=base64.urlsafe_b64decode(c["rawId"] + "=="),
            response=AuthenticatorAssertionResponse(
                client_data_json=base64.urlsafe_b64decode(r["clientDataJSON"] + "=="),
                authenticator_data=base64.urlsafe_b64decode(r["authenticatorData"] + "=="),
                signature=base64.urlsafe_b64decode(r["signature"] + "=="),
                user_handle=base64.urlsafe_b64decode(r["userHandle"] + "==") if r.get("userHandle") else None,
            ),
        )
        verification = webauthn.verify_authentication_response(
            credential=parsed,
            expected_challenge=challenge_bytes,
            expected_rp_id=_rp_id(),
            expected_origin=_origin(),
            credential_public_key=bytes(cred_row[1]),
            credential_current_sign_count=cred_row[2],
        )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(401, f"Falha na autenticação: {e}")

    await session.execute(text("""
        UPDATE webauthn_credentials SET sign_count = :sc WHERE id = :id
    """), {"sc": verification.new_sign_count, "id": str(cred_row[0])})
    await session.execute(text(
        "DELETE FROM webauthn_challenges WHERE user_id = :uid"
    ), {"uid": body.user_id})
    await session.execute(text(
        "UPDATE users SET last_login_at = NOW() WHERE id = :id"
    ), {"id": body.user_id})
    await session.commit()

    user_row = (await session.execute(text("""
        SELECT id, full_name, role FROM users WHERE id = :uid
    """), {"uid": body.user_id})).fetchone()

    token = create_access_token({
        "sub": body.user_id,
        "association_id": body.association_id,
        "role": user_row[2],
        "full_name": user_row[1],
        "linked_association_ids": [],
    })

    return {"access_token": token, "token_type": "bearer"}
