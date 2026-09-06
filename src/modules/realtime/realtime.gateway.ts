import { Injectable, Logger } from '@nestjs/common';
import { OnGatewayConnection, OnGatewayDisconnect, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtService } from '@nestjs/jwt';
import { JwtPayload } from '../auth/interfaces/jwt-payload.interface';

// Passerelle temps reel unique pour toute l'app (notifications de la cloche
// + rafraichissement des KPI/listes) — un seul canal partage plutot qu'une
// gateway par fonctionnalite, decision du 06/08. Chaque client rejoint sa
// propre room `employee:{id}` (messages personnels) et la room commune
// `company` (evenements pertinents pour tout le monde, ex: KPI dashboard).
@WebSocketGateway({ cors: { origin: process.env.CORS_ORIGIN?.split(',') ?? 'http://localhost:5173' } })
@Injectable()
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() private server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(private readonly jwtService: JwtService) {}

  // Le token est passe via `socket.handshake.auth.token` (pas de header
  // possible en WebSocket natif) — voir client frontend src/lib/socket.ts.
  handleConnection(client: Socket) {
    const token = client.handshake.auth?.token as string | undefined;
    if (!token) {
      client.disconnect();
      return;
    }
    try {
      const payload = this.jwtService.verify<JwtPayload>(token);
      client.data.employeeId = payload.employeeId;
      client.join(`employee:${payload.employeeId}`);
      client.join('company');
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect() {
    // Rien a nettoyer explicitement — socket.io retire les rooms toute seule.
  }

  notifyEmployee(employeeId: string, event: string, payload: unknown) {
    this.server?.to(`employee:${employeeId}`).emit(event, payload);
  }

  broadcastCompany(event: string, payload: unknown) {
    this.server?.to('company').emit(event, payload);
  }
}
