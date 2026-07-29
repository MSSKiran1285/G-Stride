import catalog from '../data/test-catalog.json';
import { TestOperations, type Snapshot } from './test-operations';

export default function Home() {
  return <TestOperations snapshot={catalog as Snapshot} />;
}
