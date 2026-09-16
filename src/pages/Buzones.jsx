import MailboxPanel from '../components/MailboxPanel'
import { useAuth } from '../context/AuthContext'

// Apartado propio de buzones de correo (Microsoft 365): buzones, compartidos, alias,
// uso de almacenamiento y — para Acceso total — explorador de correos y archivo en línea.
export default function Buzones() {
  const { isAdmin } = useAuth()
  return (
    <div>
      <div className="page-head">
        <h2>Buzones</h2>
        <p className="muted">
          Buzones de Microsoft 365 del tenant: personales, compartidos, salas y sus alias, con el uso de almacenamiento de cada uno.
          {isAdmin ? ' Con "Abrir" puedes revisar un buzón: descargar o eliminar correos y ver su archivo en línea.' : ''}
        </p>
      </div>
      <MailboxPanel auto page />
    </div>
  )
}
