import { Icon as Iconify, addCollection } from '@iconify/react';
import iconSubset from '../icons.json';

// ponytail: bundel subset icon (di-generate `node scripts/gen-icons.mjs`), bukan full set.
// Kalau ada nama baru di MAP, jalankan ulang script itu.
Object.values(iconSubset).forEach(addCollection);

// Nama semantik internal -> nama icon Solar (gaya linear, karakter mirip SF Symbols / macOS).
const ICONS = {
  dashboard: 'solar:widget-5-linear',
  store: 'solar:shop-2-linear',
  package: 'solar:box-linear',
  'package-search': 'solar:box-minimalistic-linear',
  'package-plus': 'solar:box-linear',
  file: 'solar:document-text-linear',
  users: 'solar:users-group-rounded-linear',
  user: 'solar:user-linear',
  'user-plus': 'solar:user-plus-linear',
  menu: 'solar:hamburger-menu-linear',
  close: 'solar:close-circle-linear',
  warehouse: 'solar:garage-linear',
  wrench: 'solar:settings-minimalistic-linear',
  'clipboard-check': 'solar:clipboard-check-linear',
  'clipboard-list': 'solar:clipboard-list-linear',
  'chevron-down': 'solar:alt-arrow-down-linear',
  'chevron-up': 'solar:alt-arrow-up-linear',
  truck: 'hugeicons:delivery-truck-01',
  cart: 'solar:cart-large-2-linear',
  'arrow-left': 'solar:arrow-left-linear',
  'arrow-right': 'solar:arrow-right-linear',
  'arrow-up': 'solar:arrow-up-linear',
  'arrow-down-right': 'solar:arrow-right-down-linear',
  'arrow-up-right': 'solar:arrow-right-up-linear',
  logout: 'solar:logout-3-linear',
  refresh: 'solar:refresh-linear',
  'rotate-ccw': 'solar:restart-linear',
  'alert-triangle': 'solar:danger-triangle-linear',
  'alert-circle': 'solar:danger-circle-linear',
  'check-circle': 'solar:check-circle-linear',
  plus: 'solar:add-circle-linear',
  trash: 'solar:trash-bin-trash-linear',
  edit: 'solar:pen-2-linear',
  'map-pin': 'solar:map-point-linear',
  download: 'solar:download-minimalistic-linear',
  lock: 'solar:lock-keyhole-minimalistic-linear',
  unlock: 'solar:lock-keyhole-minimalistic-unlocked-linear',
  send: 'solar:plain-linear',
  history: 'solar:history-linear',
  calendar: 'solar:calendar-linear',
  'trending-up': 'solar:graph-up-linear',
  coffee: 'solar:cup-hot-linear',
  save: 'solar:diskette-linear',
  filter: 'solar:filter-linear',
  search: 'solar:magnifier-linear',
  grip: 'solar:menu-dots-linear',
  settings: 'solar:settings-linear',
  image: 'solar:gallery-linear',
  info: 'solar:info-circle-linear',
  'bar-chart': 'solar:chart-2-linear',
  trophy: 'hugeicons:star-award-01',
  medal: 'hugeicons:medal-first-place',
  star: 'hugeicons:star',
  flame: 'hugeicons:fire',
  'shop-huge': 'hugeicons:store-01', // dipakai khusus Leaderboard (kop "store" lain tetap Solar)
  activity: 'solar:pulse-2-linear',
  mail: 'solar:letter-linear',
  key: 'solar:key-minimalistic-linear',
  eye: 'solar:eye-linear',
  'eye-off': 'solar:eye-closed-linear',
  clock: 'solar:clock-circle-linear',
  bell: 'solar:bell-linear',
  forbidden: 'solar:forbidden-circle-linear',
  money: 'solar:money-bag-linear',
  bill: 'solar:bill-list-linear',
  globe: 'solar:global-linear',
  archive: 'solar:safe-2-linear',
};

export default function Icon({ name, size = 18, className, style, color, ...rest }) {
  const icon = ICONS[name] || (name?.includes(':') ? name : `solar:${name}`);
  return (
    <Iconify
      icon={icon}
      width={size}
      height={size}
      className={className}
      style={color ? { color, ...style } : style}
      {...rest}
    />
  );
}
