CREATE TABLE customers (
  username TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  full_name TEXT NOT NULL,
  country TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE prostheses (
  prosthesis_id TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES customers(username),
  model TEXT NOT NULL,
  serial_number TEXT NOT NULL UNIQUE,
  issued_at DATE NOT NULL
);

INSERT INTO customers (username, email, full_name, country) VALUES
  ('user1', 'user1@example.com', 'User One', 'RU'),
  ('user2', 'user2@example.com', 'User Two', 'RU'),
  ('prothetic1', 'prothetic1@example.com', 'Prothetic One', 'RU'),
  ('prothetic2', 'prothetic2@example.com', 'Prothetic Two', 'RU'),
  ('prothetic3', 'prothetic3@example.com', 'Prothetic Three', 'RU')
ON CONFLICT (username) DO NOTHING;

INSERT INTO prostheses (prosthesis_id, username, model, serial_number, issued_at) VALUES
  ('BP-1001', 'user1', 'BionicPRO Arm X1', 'SN-BP-1001', CURRENT_DATE - INTERVAL '180 days'),
  ('BP-1002', 'user1', 'BionicPRO Grip S2', 'SN-BP-1002', CURRENT_DATE - INTERVAL '120 days'),
  ('BP-2001', 'user2', 'BionicPRO Leg L1', 'SN-BP-2001', CURRENT_DATE - INTERVAL '210 days'),
  ('BP-3001', 'prothetic1', 'BionicPRO Arm X1', 'SN-BP-3001', CURRENT_DATE - INTERVAL '90 days')
ON CONFLICT (prosthesis_id) DO NOTHING;
