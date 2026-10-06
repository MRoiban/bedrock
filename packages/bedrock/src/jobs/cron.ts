import { BedrockError } from "../error";

export function parseCron(expression: string) {
  const invalid = () => { throw new BedrockError("INVALID_CRON", `Invalid cron: ${expression}`, "Use five numeric fields: minute hour day month weekday; *, lists, ranges and /steps are supported."); };
  if (typeof expression !== "string") invalid();
  const fields = expression.trim().split(/\s+/);
  if (fields.length !== 5) invalid();
  const bounds = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 7]] as const;
  const sets = fields.map((field, index) => {
    const [min, max] = bounds[index]!;
    const values = new Set<number>();
    for (const part of field.split(",")) {
      const match = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(part);
      if (!match) invalid();
      const base = match![1]!;
      const step = Number(match![2] ?? 1);
      const range = base.split("-").map(Number);
      const start = base === "*" ? min : range[0]!;
      const end = base === "*" ? max : range[1] ?? (match![2] ? max : start);
      if (!Number.isInteger(step) || step < 1 || start < min || end > max || start > end) invalid();
      for (let value = start; value <= end; value += step) values.add(index === 4 && value === 7 ? 0 : value);
    }
    return values;
  });
  return (date: Date) => {
    const values = [date.getMinutes(), date.getHours(), date.getDate(), date.getMonth() + 1, date.getDay()];
    const day = sets[2]!.has(values[2]!);
    const weekday = sets[4]!.has(values[4]!);
    // Traditional cron uses OR when both day selectors are restricted.
    const days = fields[2]!.startsWith("*") || fields[4]!.startsWith("*") ? day && weekday : day || weekday;
    return days && [0, 1, 3].every(i => sets[i]!.has(values[i]!));
  };
}
