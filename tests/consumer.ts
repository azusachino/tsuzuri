import { Vault } from "tsuzuri";
import type { Extension } from "tsuzuri/extension";
import { agentTools } from "tsuzuri/tools";

const vault = new Vault(".");
const tools = agentTools(vault);
const extension: Extension | undefined = undefined;
void [tools, extension];
