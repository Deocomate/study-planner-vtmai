-- Seed data for schema.sql (SQLite / PostgreSQL compatible).

INSERT INTO people (id, name, role, grade) VALUES ('ben','Ben','child',5), ('shin','Shin','child',4), ('mom','Mẹ','parent',NULL);

INSERT INTO teachers (name, sort_order) VALUES ('Vinschool', 0), ('Cô Linh Cindy', 1), ('Cô Vinh', 2), ('Cô Mẫn', 3), ('Cô Giang', 4), ('EC', 5), ('Home', 6);

INSERT INTO subjects (name) VALUES ('Maths'), ('EFL'), ('Science'), ('Daily practice English'), ('Shadowing'), ('Writing'), ('Tiếng Việt'), ('Việt Nam học'), ('Debate');

INSERT INTO class_blocks (person_id, weekday, start_time, end_time, title) VALUES
  ('ben', 1, '07:00', '16:30', 'Vinschool'),
  ('ben', 2, '07:00', '16:30', 'Vinschool'),
  ('ben', 3, '07:00', '16:30', 'Vinschool'),
  ('ben', 4, '07:00', '16:30', 'Vinschool'),
  ('ben', 5, '07:00', '16:30', 'Vinschool'),
  ('shin', 1, '07:00', '16:30', 'Vinschool'),
  ('shin', 2, '07:00', '16:30', 'Vinschool'),
  ('shin', 3, '07:00', '16:30', 'Vinschool'),
  ('shin', 4, '07:00', '16:30', 'Vinschool'),
  ('shin', 5, '07:00', '16:30', 'Vinschool'),
  ('ben', 4, '20:00', '21:30', 'Writing cô Ngô Bla'),
  ('ben', 5, '19:30', '21:30', 'Debate EC'),
  ('ben', 6, '08:00', '10:00', 'Cô Linh Cindy'),
  ('ben', 6, '14:00', '15:00', 'Piano'),
  ('ben', 7, '10:30', '12:00', 'Science / Math'),
  ('ben', 7, '16:00', '18:00', 'Bóng rổ / Cầu lông'),
  ('shin', 3, '19:40', '21:40', 'Cô Linh Cindy'),
  ('shin', 4, '18:00', '19:00', 'Science cô Giang'),
  ('shin', 7, '16:30', '18:00', 'Bóng rổ'),
  ('shin', 7, '19:30', '20:30', 'Maths cô Mẫn');

INSERT INTO rewards (emoji, name, cost, ipad_minutes) VALUES
  ('📱', 'iPad 15 minutes', 20, 15),
  ('📱', 'iPad 30 minutes', 40, 30),
  ('🍦', 'Ice cream treat', 50, 0),
  ('🎁', 'Gift worth 50,000 VND', 150, 0),
  ('🎬', 'Choose the family movie', 80, 0),
  ('🎁', 'Gift worth 100,000 VND', 300, 0);

INSERT INTO point_rules (id, per_5_minutes, on_time_bonus, approved_bonus, full_day_bonus, ipad_cap_minutes) VALUES (1, 1, 5, 10, 5, 60);
