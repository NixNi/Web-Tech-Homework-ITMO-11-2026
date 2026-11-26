-- Предварительно создайте роли входа todo_app и todo_checker с отдельными паролями:
--   CREATE ROLE todo_app LOGIN PASSWORD '...';
--   CREATE ROLE todo_checker LOGIN PASSWORD '...';

REVOKE ALL ON SCHEMA todo FROM PUBLIC;
REVOKE ALL ON TABLE todo.tasks FROM PUBLIC;

GRANT USAGE ON SCHEMA todo TO todo_app, todo_checker;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE todo.tasks TO todo_app, todo_checker;
