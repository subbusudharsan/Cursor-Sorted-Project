# Sorted Email Templates (Supabase built-in)

This folder contains HTML templates for Supabase's built-in (free tier) email system. You can use these without setting up a custom domain or SMTP provider.

Templates included

- `confirm-signup.html` — Email confirmation
- `magic-link.html` — Magic link sign-in
- `reset-password.html` — Password reset (token-based)

Brand notes

- Primary brand color: Purple `#4F46E5`
- Clean white card with soft shadow
- Rounded primary button
- Footer: `© 2025 Sorted · Emotional Wellness Assistant`
- Logo placeholder: `https://YOUR_SORTED_LOGO_URL` (replace in each file)

Supabase variables used

- Confirm Signup: `{{ .ConfirmationURL }}`
- Magic Link: `{{ .RedirectURL }}`
- Reset Password: `{{ .Email }}`, `{{ .Token }}`

How to use (copy/paste)

1. Open Supabase Dashboard → Project → Authentication → Email Templates
2. For each template page:
   - Open the corresponding template type:
     - Confirm Signup → paste content from `confirm-signup.html`
     - Magic Link → paste content from `magic-link.html`
     - Reset Password → paste content from `reset-password.html`
   - Replace `https://YOUR_SORTED_LOGO_URL` with your logo URL (PNG/SVG preferred)
   - Save changes
3. Send yourself a test email from the same screen to verify

Notes

- These templates are pure HTML (inline CSS) and validated for standard email clients
- No app logic, DB, or backend changes are required or included here


