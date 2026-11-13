import { createContext, useContext, useState } from 'react';
import type { ReactNode } from 'react';

interface GridSizeContextValue {
  numColumns: number;
  cycleColumns: () => void;
}

const GridSizeContext = createContext<GridSizeContextValue>({
  numColumns: 2,
  cycleColumns: () => {},
});

export function GridSizeProvider({ children }: { children: ReactNode }) {
  const [numColumns, setNumColumns] = useState(2);

  const cycleColumns = () => {
    setNumColumns((n) => (n === 2 ? 3 : n === 3 ? 4 : 2));
  };

  return (
    <GridSizeContext.Provider value={{ numColumns, cycleColumns }}>
      {children}
    </GridSizeContext.Provider>
  );
}

export const useGridSize = () => useContext(GridSizeContext);
