# Security

## Reporting a vulnerability

Please do not publish exploitable details in a public issue. Contact the Ebnimaam owner through the support email published on the website and include:
- the affected page or endpoint;
- the steps needed to reproduce the issue;
- the expected and observed behaviour; and
- relevant request IDs or timestamps.

Do not include customer passwords, session cookies, payment credentials, API keys, or payment-card information in a report.

## Security expectations

- Keep secrets in the hosting provider's encrypted environment-variable store, never in browser code, source control, screenshots, or logs.
- Confirm payment status on the server with Paystack; browser redirects are not proof of payment.
- Scope customer data to the authenticated customer on the server.
- Check administrator sessions server-side for every protected action.
- Rate limits and payment verification must fail closed when their backing configuration is unavailable.
- Review database permission, row-level security, authentication, payment-key, and production-data changes as migrations with a tested recovery path.
