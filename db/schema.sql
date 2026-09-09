CREATE TABLE IF NOT EXISTS contact_messages (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(50),
    message         TEXT NOT NULL,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          VARCHAR(20) NOT NULL DEFAULT 'unread'
                        CHECK (status IN ('unread', 'read', 'archived')),
    deleted_at      TIMESTAMPTZ,   -- NULL = active; soft-delete only, never a hard DELETE
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_messages_submitted_at ON contact_messages (submitted_at DESC);

-- connect-pg-simple session store.
CREATE TABLE IF NOT EXISTS "session" (
    "sid"    varchar NOT NULL COLLATE "default",
    "sess"   json NOT NULL,
    "expire" timestamp(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");
