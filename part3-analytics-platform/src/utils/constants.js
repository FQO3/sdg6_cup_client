export const WATER_TYPES = [
  'tap',
  'river',
  'lake',
  'well',
  'purified',
  'mineral',
  'boiled',
  'other'
];

export const WATER_TYPE_LABELS = {
  tap: '自来水',
  river: '河水',
  lake: '湖水',
  well: '井水/地下水',
  purified: '纯净水/过滤水',
  mineral: '矿泉水',
  boiled: '煮沸后的水',
  other: '其他'
};

export const GB_GRADES = ['Ⅰ类', 'Ⅱ类', 'Ⅲ类', 'Ⅳ类', 'Ⅴ类', '劣Ⅵ类'];

export function gradeColor(index) {
  return ['#1565c0', '#42a5f5', '#66bb6a', '#ffb300', '#ef6c00', '#c62828'][index] || '#9e9e9e';
}
