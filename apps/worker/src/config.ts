import { assertPublic, parseYaml, project } from "@statusframe/core";
import source from "../statusframe.yml";
export const config = parseYaml(source);
assertPublic(project(config, [], config.incidents, config.maintenance, Date.now()), config);
