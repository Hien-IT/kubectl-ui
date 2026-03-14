// ===== Tab Navigation =====

/** Initialize resource tab navigation */
export function initTabs() {
  const tabs = document.querySelectorAll('#resource-tabs .tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
      document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
    });
  });
}

/** Switch to a specific resource tab by name */
export function switchToTab(tabName) {
  document.querySelectorAll('#resource-tabs .tab').forEach(t => t.classList.remove('active'));
  const targetTab = document.querySelector(`#resource-tabs .tab[data-tab="${tabName}"]`);
  if (targetTab) targetTab.classList.add('active');
  document.querySelectorAll('.tab-pane').forEach(p => p.classList.remove('active'));
  document.getElementById(`tab-${tabName}`).classList.add('active');
}
