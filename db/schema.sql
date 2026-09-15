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

-- Square sales reporting. Square's own Location object is static (one ID
-- for the whole truck) and has no concept of which physical spot we were
-- parked at on a given day, so that comes from the Google Calendar events
-- that already drive the live schedule instead — see services/googleCalendar.js
-- and services/salesSync.js.

-- Canonical physical locations, matched against calendar event summaries.
-- city_state is parsed from the calendar event's address the first time a
-- location is created (same parser as the public site's live schedule —
-- see getShortLocation in services/googleCalendar.js), e.g. "Berthoud, CO".
-- Sales tax is a city/county-level concern, not a venue-level one, so this
-- is what the tax report groups by.
CREATE TABLE IF NOT EXISTS sales_locations (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(255) NOT NULL UNIQUE,
    city_state  VARCHAR(255),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent add for databases where sales_locations already existed
-- before city_state was introduced.
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS city_state VARCHAR(255);

-- One row per calendar event ("visit") on a date. location_id is NULL
-- until matched/assigned; location_source records how it got set, and
-- 'manual' rows are never touched again by the sync job.
CREATE TABLE IF NOT EXISTS sales_days (
    id                      SERIAL PRIMARY KEY,
    sale_date               DATE NOT NULL,
    location_id             INTEGER REFERENCES sales_locations(id),
    location_source         VARCHAR(20) NOT NULL DEFAULT 'unmatched'
                                CHECK (location_source IN ('calendar', 'manual', 'unmatched')),
    calendar_event_summary  TEXT,
    event_start_time        TIMESTAMPTZ,
    event_end_time          TIMESTAMPTZ,
    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (sale_date, calendar_event_summary)
);

CREATE INDEX IF NOT EXISTS idx_sales_days_date ON sales_days (sale_date);
CREATE INDEX IF NOT EXISTS idx_sales_days_location ON sales_days (location_id);

-- One row per Square order, synced nightly (or via one-time backfill).
-- Money is stored in integer cents throughout, matching how Square
-- itself represents amounts, to avoid float rounding issues.
CREATE TABLE IF NOT EXISTS square_orders (
    id                    SERIAL PRIMARY KEY,
    square_order_id            VARCHAR(255) NOT NULL UNIQUE,
    sales_day_id               INTEGER NOT NULL REFERENCES sales_days(id),
    ordered_at                 TIMESTAMPTZ NOT NULL,
    subtotal_money_cents       INTEGER NOT NULL DEFAULT 0,
    tax_money_cents            INTEGER NOT NULL DEFAULT 0,
    tip_money_cents            INTEGER NOT NULL DEFAULT 0,
    discount_money_cents       INTEGER NOT NULL DEFAULT 0,
    service_charge_money_cents INTEGER NOT NULL DEFAULT 0,
    total_money_cents          INTEGER NOT NULL DEFAULT 0,
    synced_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Idempotent adds for databases where square_orders already existed
-- before the weekly-totals report needed discount/service-charge data.
ALTER TABLE square_orders ADD COLUMN IF NOT EXISTS discount_money_cents INTEGER NOT NULL DEFAULT 0;
ALTER TABLE square_orders ADD COLUMN IF NOT EXISTS service_charge_money_cents INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_square_orders_sales_day ON square_orders (sales_day_id);
CREATE INDEX IF NOT EXISTS idx_square_orders_ordered_at ON square_orders (ordered_at);

CREATE TABLE IF NOT EXISTS square_order_line_items (
    id                  SERIAL PRIMARY KEY,
    square_order_id     INTEGER NOT NULL REFERENCES square_orders(id) ON DELETE CASCADE,
    name                VARCHAR(255) NOT NULL,
    quantity            INTEGER NOT NULL,
    total_money_cents   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_square_order_line_items_order ON square_order_line_items (square_order_id);

-- Refunds/returns. Square records these as their own Order (see
-- services/salesSync.js for why they can't be treated as sales), and
-- they aren't tied to a location/sales_day — the weekly totals report
-- is purely time-based, matching how Johnny already tracks this by hand.
CREATE TABLE IF NOT EXISTS square_returns (
    id                  SERIAL PRIMARY KEY,
    square_return_id    VARCHAR(255) NOT NULL UNIQUE,
    source_order_id     VARCHAR(255),
    returned_at         TIMESTAMPTZ NOT NULL,
    return_money_cents  INTEGER NOT NULL,
    synced_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_square_returns_returned_at ON square_returns (returned_at);
