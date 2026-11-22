import {homedir} from 'node:os';
import {join} from 'node:path';

export const DEFAULT_WORKSPACE=join(homedir(),'.dibi-drama');

export function resolveWorkspaceSetting(explicit, environment=process.env.WORKBENCH_WORKSPACE){
  for(const value of [explicit,environment]){
    if(typeof value==='string'&&value.trim())return value.trim();
  }
  return DEFAULT_WORKSPACE;
}
