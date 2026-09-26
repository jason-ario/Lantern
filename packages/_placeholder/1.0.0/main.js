(async () => {
  const ctx = await Platform.ready();
  document.getElementById('title').textContent = ctx.gameTitle || 'Untitled';
  document.title = ctx.gameTitle || 'Placeholder';
  if (ctx.gameId) document.getElementById('bg').style.backgroundImage = `url(/media/${encodeURIComponent(ctx.gameId)}/hero.svg)`;
  document.getElementById('mode').textContent = ctx.mode === 'demo' ? 'Demo' : 'Full game';
  const me = await Platform.user.getCurrentUser();
  document.getElementById('player').textContent = me.displayName;
  const launches = ((await Platform.storage.load('launches')) || 0) + 1;
  await Platform.storage.save('launches', launches);
  document.getElementById('launches').textContent = launches;
  if (launches >= 1) Platform.achievements.unlock('first_steps');
  if (launches >= 3) Platform.achievements.unlock('regular');
  if (launches >= 10) Platform.achievements.unlock('dedicated');
  document.getElementById('quit').onclick = () => Platform.game.exit();
})();
