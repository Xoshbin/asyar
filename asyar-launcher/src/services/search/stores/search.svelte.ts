class SearchStores {
  query = $state("");
  selectedIndex = $state(-1);
  isLoading = $state(false);
}

export const searchStores = new SearchStores();
