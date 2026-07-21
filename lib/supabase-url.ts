export function normalizeSupabaseUrl(configured:string|undefined){
  if(!configured)return undefined;
  const projectRef=configured.match(/[a-z0-9]{20}/i)?.[0];
  return projectRef?`https://${projectRef}.supabase.co`:undefined;
}
