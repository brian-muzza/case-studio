import { createRoot } from 'react-dom/client';
import { App } from './App';
import { Render } from './Render';
import { Board } from './components/Board';
import './styles.css';

const isRender = new URLSearchParams(location.search).has('render');
if (isRender) document.documentElement.classList.add('render');
const isBoard = new URLSearchParams(location.search).get('vista') === 'tablero';
createRoot(document.getElementById('root')!).render(isRender ? <Render /> : isBoard ? <Board /> : <App />);
