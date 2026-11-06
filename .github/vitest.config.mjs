import { fileURLToPath } from 'node:url';

export default {
  root: fileURLToPath(new URL('../', import.meta.url)),
  test: {
    include: ['src/**/*.test.{js,ts,tsx}'],
    pool: 'forks',
    maxWorkers: 1,
    fileParallelism: false,
  },
};
