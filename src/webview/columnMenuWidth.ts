import type { GetMainMenuItems } from 'ag-grid-community';
import { parseColumnWidthUserInput } from './columnWidthInput';

/** Appends 「列幅を指定…」 to the column header menu (right-click / menu button). */
export const getMainMenuItemsWithSetColumnWidth: GetMainMenuItems = (params) => {
  const items = [...params.defaultItems];
  items.push('separator');
  items.push({
    name: '\u5217\u5E45\u3092\u6307\u5B9A\u2026',
    action: () => {
      const col = params.column;
      const colId = col.getColId();
      const current = col.getActualWidth();
      const colDef = col.getColDef();
      const minW = typeof colDef.minWidth === 'number' ? colDef.minWidth : 60;
      const raw = window.prompt(
        `\u5217\u5E45 (px)\n\u6700\u5C0F: ${minW}`,
        String(current)
      );
      if (raw == null) return;
      const parsed = parseColumnWidthUserInput(raw, minW);
      if (parsed == null) {
        window.alert('1\u4EE5\u4E0A\u306E\u6574\u6570 (px) \u3092\u5165\u529B\u3057\u3066\u304F\u3060\u3055\u3044\u3002');
        return;
      }
      params.api.setColumnWidths([{ key: colId, newWidth: parsed }]);
    },
  });
  return items;
};
