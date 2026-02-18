import { createRoot } from 'react-dom/client';
import '../global.css';
import { ControlApp } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<ControlApp />);
