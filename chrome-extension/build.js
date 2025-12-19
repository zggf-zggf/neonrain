const fs = require('fs');
const path = require('path');

const dist = path.join(__dirname, 'dist');

// Clean and create dist directory
if (fs.existsSync(dist)) {
  fs.rmSync(dist, { recursive: true });
}
fs.mkdirSync(dist);
fs.mkdirSync(path.join(dist, 'popup'));
fs.mkdirSync(path.join(dist, 'icons'));

// Copy files
const copies = [
  ['public/manifest.json', 'manifest.json'],
  ['popup/popup.html', 'popup/popup.html'],
  ['popup/popup.css', 'popup/popup.css'],
  ['popup/popup.js', 'popup/popup.js'],
  ['src/content/discord-injector.js', 'discord-injector.js'],
  ['src/content/discord-content.js', 'discord-content.js'],
  ['src/background/background.js', 'background.js'],
];

copies.forEach(([src, dest]) => {
  const srcPath = path.join(__dirname, src);
  const destPath = path.join(dist, dest);
  if (fs.existsSync(srcPath)) {
    fs.copyFileSync(srcPath, destPath);
    console.log(`Copied: ${src} -> dist/${dest}`);
  } else {
    console.warn(`Warning: ${src} not found`);
  }
});

// Copy icons directory
const iconsSrc = path.join(__dirname, 'public/icons');
const iconsDest = path.join(dist, 'icons');
if (fs.existsSync(iconsSrc)) {
  fs.readdirSync(iconsSrc).forEach(file => {
    fs.copyFileSync(
      path.join(iconsSrc, file),
      path.join(iconsDest, file)
    );
  });
  console.log('Copied: icons/');
}

console.log('\nBuild complete! Load dist/ folder in Chrome as unpacked extension.');
