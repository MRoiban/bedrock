// Golem (github.com/MRoiban/golem) gives Onyx controls an optional Anima motion part. Pebbles get
// it with no code: the names below replace Onyx's (Golem's CI checks they accept the same props),
// and every pebble serves the Anima runtime of its installed Golem at a path that carries Golem's
// version, so a cached runtime can never meet a newer page. Without the runtime, under reduced
// motion, or if anything fails, each control is plain Onyx.
import { configureAnima } from "@mroiban/golem";
import golem from "@mroiban/golem/package.json" with { type: "json" };

/** Where this pebble serves the Anima runtime and Golem's scenes (packages/bedrock: runtime/anima.ts). */
export const animaPath = `/_bedrock/anima/${golem.version}/`;
configureAnima({ runtime: `${animaPath}anima.js`, scenes: `${animaPath}scenes/` });

export {
  AccordionTrigger, Alert, Button, Checkbox, CollapsibleTrigger, Meter, PasswordField, Progress,
  RadioGroupItem, SectionSelect, Slider, Spinner, Switch, TabsList, ToastProvider, ToastQueueViewport,
  Toggle, ToggleGroup, GolemProvider, useGolem,
} from "@mroiban/golem";
