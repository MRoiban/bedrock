ALTER TABLE deploy_tokens ADD COLUMN name TEXT;
ALTER TABLE deploy_tokens ADD COLUMN scope TEXT;
ALTER TABLE deploy_tokens ADD COLUMN user_id TEXT REFERENCES users(id);
UPDATE deploy_tokens SET user_id=(SELECT id FROM users WHERE users.email=deploy_tokens.email);
