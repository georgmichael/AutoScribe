import { createRoot } from 'react-dom/client';
import '../global.css';
import { DisplayApp } from './App';

const root = createRoot(document.getElementById('root')!);
root.render(<DisplayApp />);
