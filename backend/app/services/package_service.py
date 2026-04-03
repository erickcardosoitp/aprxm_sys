from datetime import datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.config import get_settings
from app.core.exceptions import NotFoundError, UnprocessableError
from app.models.finance import TransactionType
from app.models.package import Package, PackageStatus
from app.models.resident import Resident, ResidentStatus
from app.services.finance_service import FinanceService

settings = get_settings()

DELIVERY_FEE = Decimal(str(settings.delivery_fee_default))


class PackageService:
    """
    Handles package lifecycle: reception, notification, delivery with fee logic.

    Business rule:
      On delivery, if the recipient is NOT an active (adimplente) member,
      a delivery fee of R$ 2.50 is automatically charged and a transaction
      is created in the open cash session.
    """

    def __init__(self, session: AsyncSession) -> None:
        self._session = session
        self._finance = FinanceService(session)

    # ------------------------------------------------------------------
    # Reception
    # ------------------------------------------------------------------

    async def receive_package(
        self,
        association_id: UUID,
        received_by: UUID,
        unit: str,
        block: str | None,
        photo_urls: list[dict],
        resident_id: UUID | None = None,
        carrier_name: str | None = None,
        tracking_code: str | None = None,
        object_type: str | None = None,
        notes: str | None = None,
    ) -> Package:
        if not photo_urls:
            raise UnprocessableError("Ao menos uma foto da etiqueta é obrigatória.")

        package = Package(
            association_id=association_id,
            resident_id=resident_id,
            unit=unit,
            block=block,
            photo_urls=photo_urls,
            carrier_name=carrier_name,
            tracking_code=tracking_code,
            object_type=object_type,
            notes=notes,
            received_by=received_by,
        )
        self._session.add(package)
        await self._session.flush()
        return package

    # ------------------------------------------------------------------
    # Delivery
    # ------------------------------------------------------------------

    async def deliver_package(
        self,
        package_id: UUID,
        association_id: UUID,
        delivered_by: UUID,
        delivered_to_name: str,
        signature_url: str,
        delivered_to_cpf: str | None = None,
        delivered_to_resident_id: UUID | None = None,
        cash_session_id: UUID | None = None,
        deliverer_name: str | None = None,
        deliverer_signature_url: str | None = None,
        proof_of_residence_verified: bool = False,
        recipient_id_photo_url: str | None = None,
    ) -> Package:
        package = await self._get_package(package_id, association_id)

        if package.status == PackageStatus.delivered:
            raise UnprocessableError("Encomenda já foi entregue.")

        # Determine if fee applies
        resident = await self._resolve_resident(
            delivered_to_resident_id or package.resident_id, association_id
        )
        is_active_member = self._is_active_member(resident)

        if not is_active_member:
            # Charge fee — open session required
            cash_session = await self._finance.get_open_session(association_id)
            tx = await self._finance.register_transaction(
                association_id=association_id,
                cash_session_id=cash_session.id,
                tx_type=TransactionType.income,
                amount=DELIVERY_FEE,
                description=f"Taxa de entrega — {delivered_to_name} (Unid. {package.unit})",
                created_by=delivered_by,
                package_id=package_id,
            )
            package.has_delivery_fee = True
            package.delivery_fee_amount = DELIVERY_FEE
            package.delivery_fee_paid = True
            package.delivery_fee_tx_id = tx.id

        # Update package
        package.status = PackageStatus.delivered
        package.delivered_to_name = delivered_to_name
        package.delivered_to_cpf = delivered_to_cpf
        package.delivered_to_resident_id = delivered_to_resident_id
        package.signature_url = signature_url
        package.deliverer_name = deliverer_name
        package.deliverer_signature_url = deliverer_signature_url
        package.proof_of_residence_verified = proof_of_residence_verified
        package.recipient_id_photo_url = recipient_id_photo_url
        package.delivered_at = datetime.utcnow()
        package.delivered_by = delivered_by
        package.updated_at = datetime.utcnow()

        self._session.add(package)
        return package

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    async def _get_package(self, package_id: UUID, association_id: UUID) -> Package:
        stmt = select(Package).where(
            Package.id == package_id,
            Package.association_id == association_id,
        )
        result = await self._session.execute(stmt)
        pkg = result.scalar_one_or_none()
        if not pkg:
            raise NotFoundError("Encomenda")
        return pkg

    async def _resolve_resident(
        self, resident_id: UUID | None, association_id: UUID
    ) -> Resident | None:
        if not resident_id:
            return None
        stmt = select(Resident).where(
            Resident.id == resident_id,
            Resident.association_id == association_id,
        )
        result = await self._session.execute(stmt)
        return result.scalar_one_or_none()

    @staticmethod
    def _is_active_member(resident: Resident | None) -> bool:
        if not resident:
            return False
        return resident.type == ResidentType.member and resident.status == ResidentStatus.active

    async def list_packages(
        self,
        association_id: UUID,
        status: PackageStatus | None = None,
    ) -> list[Package]:
        stmt = select(Package).where(Package.association_id == association_id)
        if status:
            stmt = stmt.where(Package.status == status)
        stmt = stmt.order_by(Package.received_at.desc())
        result = await self._session.execute(stmt)
        return list(result.scalars().all())
