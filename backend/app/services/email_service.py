from __future__ import annotations

import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.config import get_settings


def send_email(to: str, subject: str, html: str) -> None:
    s = get_settings()
    if not s.smtp_user or not s.smtp_password:
        return

    msg = MIMEMultipart("alternative")
    msg["Subject"] = subject
    msg["From"] = s.smtp_from
    msg["To"] = to
    msg.attach(MIMEText(html, "html", "utf-8"))

    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=10) as srv:
        srv.starttls()
        srv.login(s.smtp_user, s.smtp_password)
        srv.sendmail(s.smtp_user, to, msg.as_string())


def reminder_html(demand_title: str, due_date: str, so_num: str | None) -> str:
    os_line = f"<p><strong>OS:</strong> #{so_num}</p>" if so_num else ""
    return f"""
<div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px">
  <h2 style="color:#1a3f6f;margin-bottom:4px">⏰ Lembrete de prazo</h2>
  <p>Você tem uma tarefa com prazo <strong>hoje ({due_date})</strong>:</p>
  <div style="background:#f3f4f6;border-radius:8px;padding:16px;margin:16px 0">
    <p style="font-size:16px;font-weight:600;margin:0">{demand_title}</p>
    {os_line}
  </div>
  <p style="color:#6b7280;font-size:13px">APRXM — Sistema de Gestão Comunitária</p>
</div>
"""
