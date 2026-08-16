import * as action from "@actions/core";
import { runAction } from "./runner.js";

runAction(action).catch((error: unknown) => {
  action.setFailed(error instanceof Error ? error.message : String(error));
});
