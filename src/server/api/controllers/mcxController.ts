import type { AppContext } from '../context';
import type { Handler } from '../http';
import { mcxCatalog } from '../../services/mcx/mcxCatalog';

export function mcxController(ctx: AppContext) {
  /** MCX products with their live contracts, option availability and strike ladder. */
  const products: Handler = async () => {
    await ctx.instrumentStore.load();
    return mcxCatalog(ctx.instrumentStore);
  };

  return { products };
}
