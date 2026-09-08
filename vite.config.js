import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

// GitHub Pages project sites are served from /<repository-name>/.
// In GitHub Actions we can derive that path automatically from GITHUB_REPOSITORY.
// Local development and Firebase Hosting continue to use '/'.
const githubRepo = process.env.GITHUB_REPOSITORY?.split('/')[1];
const isGitHubActions = process.env.GITHUB_ACTIONS === 'true' && githubRepo;

export default defineConfig({
  base: isGitHubActions ? `/${githubRepo}/` : '/',
  plugins: [tailwindcss()],
  server: {
    host: true,
    port: 5173,
  },
});
