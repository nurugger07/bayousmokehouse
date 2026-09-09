CREATE TABLE IF NOT EXISTS contact_messages (
    id              SERIAL PRIMARY KEY,
    name            VARCHAR(255) NOT NULL,
    email           VARCHAR(255) NOT NULL,
    phone           VARCHAR(50),
    message         TEXT NOT NULL,
    category        VARCHAR(20) NOT NULL DEFAULT 'general_inquiry'
                        CHECK (category IN ('private_event', 'brewery_event', 'general_inquiry', 'catering')),
    -- Catering-specific structured fields. NULL for every other category;
    -- populated only when category = 'catering' (enforced at the route
    -- layer, not the database, same as the rest of this table).
    event_type      VARCHAR(50)
                        CHECK (event_type IS NULL OR event_type IN (
                            'backyard_party', 'wedding', 'birthday', 'graduation',
                            'corporate_event', 'brewery_festival', 'other'
                        )),
    event_date      DATE,
    start_time      TIME,
    end_time        TIME,
    location        TEXT,
    guest_count     INTEGER,
    submitted_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    status          VARCHAR(20) NOT NULL DEFAULT 'unread'
                        CHECK (status IN ('unread', 'read', 'archived')),
    deleted_at      TIMESTAMPTZ,   -- NULL = active; soft-delete only, never a hard DELETE
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent add for databases where contact_messages already existed
-- before the category column was introduced.
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'general_inquiry';

-- Idempotent adds for databases where contact_messages already existed
-- before the catering request fields were introduced.
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS event_type VARCHAR(50);
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS event_date DATE;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS start_time TIME;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS end_time TIME;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS location TEXT;
ALTER TABLE contact_messages ADD COLUMN IF NOT EXISTS guest_count INTEGER;

-- Re-create these CHECK constraints unconditionally (cheap, and Postgres
-- has no "ADD CONSTRAINT IF NOT EXISTS") so 'catering' and the event_type
-- values stay valid on databases that already had this table.
ALTER TABLE contact_messages DROP CONSTRAINT IF EXISTS contact_messages_category_check;
ALTER TABLE contact_messages ADD CONSTRAINT contact_messages_category_check
    CHECK (category IN ('private_event', 'brewery_event', 'general_inquiry', 'catering'));

ALTER TABLE contact_messages DROP CONSTRAINT IF EXISTS contact_messages_event_type_check;
ALTER TABLE contact_messages ADD CONSTRAINT contact_messages_event_type_check
    CHECK (event_type IS NULL OR event_type IN (
        'backyard_party', 'wedding', 'birthday', 'graduation',
        'corporate_event', 'brewery_festival', 'other'
    ));

CREATE INDEX IF NOT EXISTS idx_contact_messages_status ON contact_messages (status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_messages_category ON contact_messages (category) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_contact_messages_submitted_at ON contact_messages (submitted_at DESC);

-- connect-pg-simple session store.
CREATE TABLE IF NOT EXISTS "session" (
    "sid"    varchar NOT NULL COLLATE "default",
    "sess"   json NOT NULL,
    "expire" timestamp(6) NOT NULL,
    CONSTRAINT "session_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire");

-- Admin-authored notes documenting communication about a contact
-- message (e.g. "called back 9/10, booked catering for the 14th").
CREATE TABLE IF NOT EXISTS contact_message_notes (
    id                  SERIAL PRIMARY KEY,
    contact_message_id  INTEGER NOT NULL REFERENCES contact_messages(id) ON DELETE CASCADE,
    note                TEXT NOT NULL,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_message_notes_message_id ON contact_message_notes (contact_message_id);
