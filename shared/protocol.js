// ============================================================================
// Network protocol. All messages are JSON objects with a `t` (type) field and
// are sent over a single WebSocket at /ws. The `ws` library compresses
// larger messages with permessage-deflate.
//
// CLIENT -> SERVER
//   join      {name, room, create, seed, token}  first message on connect
//   pos       {p:[x,y,z], r:[yaw,pitch], f:flying, m:moving, s:sneaking, h:heldItemId}  ~20/s
//   reqChunks {list:[[cx,cz],...]}            ask for edit deltas of chunks
//   break     {x,y,z, held}                   break a block (held = item id)
//   place     {x,y,z, id}                     place a block
//   attack    {mob}                           hit a mob
//   drop      {item:{id,count,dmg}, dir:[x,y,z]}  throw an item
//   chat      {text}
//   inv       {slots, health, hunger}         inventory snapshot (persisted)
//   respawn   {}
//   furnaceOpen  {x,y,z} / furnaceClose {}
//   furnacePut   {x,y,z, slot, item}          put item into furnace slot (0 input, 1 fuel)
//   furnaceTake  {x,y,z, slot}                take whole stack out of slot
//   host      {action:'mode'|'time'|'kick', value}
//   ping      {c}
//
// SERVER -> CLIENT
//   welcome   {id, room, seed, host, mode, time, spawn, you:{pos, inv, health, hunger}, players}
//   error     {msg}
//   chunks    {list:[[cx,cz,[idx,id,idx,id,...]],...]}   edit deltas per chunk
//   block     {x,y,z,id}                       a block changed
//   snap      {p:[[id,x,y,z,yaw,pitch,flags,heldItem],...], m:[[id,type,x,y,z,yaw,hurt],...]}  ~20/s
//             flags: 1 flying, 2 moving, 4 sneaking
//   join/leave {id,name} ; players {list} ; host {id}
//   chat      {from, text, sys}
//   mode      {mode} ; time {time}
//   items     {add:[[id,itemId,count,x,y,z]], remove:[id]}  dropped item entities
//   pickup    {item:{id,count,dmg}}
//   hurt      {amount, from:[x,y,z]}          you took damage (mobs)
//   teleport  {p:[x,y,z]}                     server corrected your position
//   furnace   {x,y,z, slots:[in,fuel,out], burn, burnMax, progress}
//   kicked    {reason}
//   pong      {c}
// ============================================================================

export const GAME_MODES = ['survival', 'creative'];

/** Validate a 4-letter room code. */
export function isValidRoomCode(code) {
  return typeof code === 'string' && /^[A-Z]{4}$/.test(code);
}

export function randomRoomCode() {
  // No vowels-only confusion: skip I and O which look like 1 and 0.
  const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let s = '';
  for (let i = 0; i < 4; i++) s += letters[Math.floor(Math.random() * letters.length)];
  return s;
}

export function sanitizeName(name) {
  const n = String(name || '').replace(/[^\w\- ]/g, '').trim().slice(0, 16);
  return n || 'Player';
}
