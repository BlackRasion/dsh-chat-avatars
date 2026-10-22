import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

// 宿主契约（dsh 0.2.1-rc.2 `dsh-app-boot` readPluginMeta/iconOf）：
// - 插件 icon 来自 package.json 根 `icon`（相对路径）或导出的 `<包名>/icon`；本项目只用后者。
// - 只接受 .svg/.png/.jpg/.jpeg/.webp，原始字节 ≤256 KiB；图标失败只记诊断，不影响插件加载。
const MAX_ICON_BYTES = 256 * 1024;
const ICON_MEDIA = new Map([
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp']
]);

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
const exported = pkg.exports?.['./icon'];
const iconRel = typeof exported === 'string' ? exported : '';
const iconExt = iconRel.slice(iconRel.lastIndexOf('.')).toLowerCase();
const iconPath = fileURLToPath(new URL('../' + iconRel.replace(/^\.\//, ''), import.meta.url));

function sniffMedia(bytes, ext) {
  if (ext === '.jpg' || ext === '.jpeg') {
    return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff ? 'image/jpeg' : null;
  }
  if (ext === '.png') {
    return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
      ? 'image/png'
      : null;
  }
  if (ext === '.webp') {
    return bytes.subarray(0, 4).toString('ascii') === 'RIFF' &&
      bytes.subarray(8, 12).toString('ascii') === 'WEBP'
      ? 'image/webp'
      : null;
  }
  if (ext === '.svg') {
    const head = bytes.subarray(0, 512).toString('utf8').trimStart();
    return head.startsWith('<svg') || head.startsWith('<?xml') ? 'image/svg+xml' : null;
  }
  return null;
}

test('插件 icon 导出指向宿主支持的本地资源', () => {
  assert.equal(typeof exported, 'string', 'package.json.exports["./icon"] 必须是字符串');
  assert.match(iconRel, /^\.\/icon\.(svg|png|jpg|jpeg|webp)$/);
  assert.ok(ICON_MEDIA.has(iconExt), `不支持的 icon 扩展名：${iconExt}`);
  assert.ok(pkg.files.includes(iconRel.slice(2)), 'files 必须包含 icon 文件');
  if (pkg.icon !== undefined) {
    assert.equal(pkg.icon, iconRel, 'package.json 根 icon 与 exports["./icon"] 应指向同一文件');
  }
});

test('插件 icon 文件存在、≤256 KiB 且内容格式匹配扩展名', () => {
  const stat = statSync(iconPath);
  assert.ok(stat.isFile(), 'icon 必须是普通文件');
  assert.ok(stat.size <= MAX_ICON_BYTES, `icon ${stat.size} B 超过宿主上限 ${MAX_ICON_BYTES} B`);
  const bytes = readFileSync(iconPath);
  assert.equal(sniffMedia(bytes, iconExt), ICON_MEDIA.get(iconExt), 'icon 内容与扩展名不一致');
});
