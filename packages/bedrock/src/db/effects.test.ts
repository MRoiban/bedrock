import { expect, test } from "bun:test";
import { openDatabase } from "./index";
import { sqliteTable, integer } from "drizzle-orm/sqlite-core";
import { tempDirectory } from "../../test/helpers";

const parents = sqliteTable("parents", { id: integer().primaryKey() });
const children = sqliteTable("children", { id: integer().primaryKey(), parent: integer() });
const audit = sqliteTable("audit", { id: integer().primaryKey() });
const final = sqliteTable("final", { id: integer().primaryKey() });
test("write sets expand transitively through cascades and triggers without matching SQL literals", async () => {
  const temp = tempDirectory();
  let database = openDatabase(temp.dir, { parents, children, audit, final });
  try {
    database.sqlite.exec(`
      CREATE TABLE parents(id INTEGER PRIMARY KEY);
      CREATE TABLE children(id INTEGER PRIMARY KEY, parent INTEGER REFERENCES parents(id) ON DELETE CASCADE);
      CREATE TABLE audit(id INTEGER PRIMARY KEY);
      CREATE TABLE final(id INTEGER PRIMARY KEY);
      CREATE TRIGGER child_deleted AFTER DELETE ON children BEGIN INSERT INTO audit VALUES(old.id); END;
      CREATE TRIGGER audited AFTER INSERT ON audit BEGIN INSERT INTO final VALUES(new.id); END;
      INSERT INTO parents VALUES(1); INSERT INTO children VALUES(1,1);
    `);
    database.close();
    database = openDatabase(temp.dir, { parents, children, audit, final });
    const usage = await database.tracker.capture(() => database.db.delete(parents).run());
    expect([...usage.writes].sort()).toEqual(["audit", "children", "final", "parents"]);
    expect(database.sqlite.query("SELECT * FROM final").all()).toEqual([{ id: 1 }]);
  } finally { database.close(); temp.cleanup(); }
});
