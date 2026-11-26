# Ebnimaam verification email template

The branded HTML template is stored in emails/verification-code.html. It uses the {{ .Token }} placeholder supplied in the owner's original template.

The live Neon Auth project uses Managed Better Auth and its shared email provider. The application name and sender display name are now set to ebnimaam; the existing OTP verification method, sign-up verification requirement and delivery provider were kept enabled.

Managed Better Auth's current shared sender does not accept a custom HTML template through the available provider configuration. A custom HTML message requires a verified send.otp webhook and a transactional email provider or SMTP credentials. Do not enable the webhook until those credentials and a working delivery test are available, because an enabled webhook replaces the default OTP delivery path.

The HTML file is therefore prepared in source control but is not claimed to be the actual body currently sent by Neon Auth. The existing working OTP email path remains active.
