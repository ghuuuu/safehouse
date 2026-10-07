-- Female or male, for the family tree (D33).
--
-- Nullable, and left null for every existing person. A household that has
-- never said is "not recorded", and a default would quietly assert something
-- nobody entered.
--
-- No grant changes. The application role already reads and inserts `people`
-- through `people_read` and `people_write`, and a new column inherits the
-- table's privileges. The sign-in role still has none on this table (D24).

create type person_sex as enum ('female', 'male');
--> statement-breakpoint
alter table people add column sex person_sex;
