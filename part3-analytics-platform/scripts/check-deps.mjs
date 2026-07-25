const modules = ['dotenv', 'better-sqlite3', 'express', 'nuxt', 'vue', 'vue-router'];
for (const mod of modules) {
  try {
    const resolved = require.resolve(mod, { paths: [process.cwd()] });
    console.log(`${mod}: OK (${resolved})`);
  } catch {
    console.log(`${mod}: MISSING`);
  }
}