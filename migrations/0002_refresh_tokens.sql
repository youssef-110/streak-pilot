-- GitHub user tokens expire after 8 hours; keep the refresh token so runs can renew them.
ALTER TABLE users ADD COLUMN refresh_enc TEXT;
ALTER TABLE users ADD COLUMN token_expires_at INTEGER;
