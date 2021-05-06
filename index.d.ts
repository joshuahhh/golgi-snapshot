import * as React from 'react';

declare module 'react' {
  function useContext<T>(
    context: React.Context<T>
  ): T;
}