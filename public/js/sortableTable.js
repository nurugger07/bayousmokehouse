// Click a <th> to sort its table's tbody rows by that column. Money/
// numeric columns carry a data-sort-value (raw cents/count) on each
// <td> so sorting is numeric, not a lexicographic string compare on
// "$12.34" text. Only tables marked data-sortable opt in — the Weekly
// Totals report's multi-tbody month/week layout isn't a flat sortable
// list, so it's deliberately left out.
(function () {
  var tables = document.querySelectorAll('.admin-table[data-sortable]');
  if (!tables.length) return;

  function cellValue(row, index) {
    var cell = row.children[index];
    if (!cell) return '';
    return cell.dataset.sortValue !== undefined ? cell.dataset.sortValue : cell.textContent.trim();
  }

  function compare(a, b, type) {
    if (type === 'number') {
      return parseFloat(a) - parseFloat(b);
    }
    return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  }

  tables.forEach(function (table) {
    var headerRow = table.querySelector('thead tr');
    if (!headerRow) return;

    Array.from(headerRow.children).forEach(function (th, index) {
      th.classList.add('is-sortable');
      th.setAttribute('tabindex', '0');
      th.setAttribute('role', 'button');

      function sort() {
        var type = th.dataset.sortType || 'text';
        var direction = th.dataset.sortDir === 'asc' ? 'desc' : 'asc';

        Array.from(headerRow.children).forEach(function (other) {
          delete other.dataset.sortDir;
          other.classList.remove('sorted-asc', 'sorted-desc');
        });
        th.dataset.sortDir = direction;
        th.classList.add(direction === 'asc' ? 'sorted-asc' : 'sorted-desc');

        table.querySelectorAll('tbody').forEach(function (tbody) {
          var rows = Array.from(tbody.querySelectorAll('tr'));
          rows.sort(function (rowA, rowB) {
            var result = compare(cellValue(rowA, index), cellValue(rowB, index), type);
            return direction === 'asc' ? result : -result;
          });
          rows.forEach(function (row) {
            tbody.appendChild(row);
          });
        });
      }

      th.addEventListener('click', sort);
      th.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          sort();
        }
      });
    });
  });
})();
