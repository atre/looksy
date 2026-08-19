#!/usr/bin/env node
import('../dist/cli.js').catch((err) => {
  if (err?.code === 'ERR_MODULE_NOT_FOUND' && /dist[/\\]cli\.js/.test(err.message ?? '')) {
    console.error(
      'looksy: build artifacts missing — run "npm run build" in the looksy directory (or reinstall the package).',
    );
  } else {
    console.error(`looksy: ${err?.message ?? err}`);
  }
  process.exit(1);
});
