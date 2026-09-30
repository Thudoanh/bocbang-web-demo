"""Email delivery boundary for account verification and password reset."""

from __future__ import annotations

import asyncio
import smtplib
import ssl
from email.message import EmailMessage
from typing import Protocol

from app.core.config import Settings
from app.core.errors import ApiError


class EmailSender(Protocol):
    async def send_otp(self, recipient: str, code: str, purpose: str) -> None: ...


class UnavailableEmailSender:
    async def send_otp(self, recipient: str, code: str, purpose: str) -> None:
        raise ApiError("EMAIL_DELIVERY_UNAVAILABLE", "Email delivery is not configured.", 503)


class SmtpEmailSender:
    def __init__(self, settings: Settings) -> None:
        if not all((settings.email_from, settings.email_smtp_host)):
            raise ValueError("EMAIL_FROM and EMAIL_SMTP_HOST are required for SMTP email delivery.")
        self._sender = settings.email_from
        self._host = settings.email_smtp_host
        self._port = settings.email_smtp_port
        self._username = settings.email_smtp_username
        self._password = settings.email_smtp_password
        self._use_tls = settings.email_smtp_use_tls

    async def send_otp(self, recipient: str, code: str, purpose: str) -> None:
        subject = (
            "Verify your Bóc Băng AI email"
            if purpose == "verify_email"
            else "Reset your Bóc Băng AI password"
        )
        message = EmailMessage()
        message["From"] = self._sender
        message["To"] = recipient
        message["Subject"] = subject
        message.set_content(f"Your verification code is {code}. It expires in 10 minutes.")
        try:
            await asyncio.to_thread(self._send, message)
        except OSError as exc:
            raise ApiError("EMAIL_DELIVERY_FAILED", "Unable to send email.", 502) from exc

    def _send(self, message: EmailMessage) -> None:
        with smtplib.SMTP(self._host, self._port, timeout=15) as client:
            if self._use_tls:
                client.starttls(context=ssl.create_default_context())
            if self._username and self._password:
                client.login(self._username, self._password)
            client.send_message(message)


def build_email_sender(settings: Settings) -> EmailSender:
    if settings.email_provider == "smtp":
        try:
            return SmtpEmailSender(settings)
        except ValueError:
            return UnavailableEmailSender()
    return UnavailableEmailSender()
