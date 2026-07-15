// makeGrid(rows, cols) builds a rows x cols grid with every cell set to 0.
function makeGrid(rows, cols) {
  const row = new Array(cols).fill(0)
  return new Array(rows).fill(row)
}

// setCell writes v at grid[r][c] and returns the grid.
function setCell(grid, r, c, v) {
  grid[r][c] = v
  return grid
}

module.exports = { makeGrid, setCell }
