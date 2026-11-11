CREATE TABLE onesa_factory_links (
  issuer text NOT NULL, subject uuid NOT NULL, user_id integer NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  local_access_approved boolean NOT NULL DEFAULT false, PRIMARY KEY(issuer,subject)
);
--> statement-breakpoint
CREATE TABLE onesa_factory_transactions (
  state_hash text PRIMARY KEY, browser_hash text NOT NULL, verifier text NOT NULL, return_to text NOT NULL,
  link_user_id integer REFERENCES users(id) ON DELETE CASCADE, link_version integer,
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes'
);
--> statement-breakpoint
CREATE INDEX onesa_factory_transactions_expiry ON onesa_factory_transactions(expires_at);
--> statement-breakpoint
CREATE TABLE onesa_factory_sessions (
  session_id uuid PRIMARY KEY, user_id integer NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  encrypted_grant text NOT NULL, expires_at timestamptz NOT NULL
);
--> statement-breakpoint
CREATE INDEX onesa_factory_sessions_expiry ON onesa_factory_sessions(expires_at);
