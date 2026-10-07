import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { User } from '../users/entities/user.entity';
import { Persona } from '../users/entities/persona.entity';
import {
  ActualizarEmpresaDto,
  ActualizarPerfilDto,
  CambiarContrasenaDto,
  CambiarCorreoDto,
  Empresa,
  Perfil,
} from './cuenta.types';

const iso = (d: Date | null | undefined) =>
  d ? new Date(d).toISOString() : null;
const vacioANull = (v: string | undefined) => (v === '' ? null : v);

/** Datos que el propio usuario administra: su perfil y los de su empresa. */
@Injectable()
export class CuentaService {
  constructor(
    @InjectRepository(User) private readonly users: Repository<User>,
    @InjectRepository(Persona) private readonly personas: Repository<Persona>,
  ) {}

  async perfil(userId: number): Promise<Perfil> {
    const u = await this.users
      .createQueryBuilder('u')
      .addSelect('u.avatar')
      .where('u.id = :userId', { userId })
      .getOne();
    if (!u) throw new NotFoundException('Usuario no encontrado');
    return {
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      telefono: u.telefono,
      cargo: u.cargo,
      avatar: u.avatar ?? null,
      ultimoLogin: iso(u.ultimoLogin),
      ultimoAgente: u.ultimoAgente,
      contrasenaActualizada: iso(u.contrasenaActualizada),
    };
  }

  async actualizarPerfil(userId: number, dto: ActualizarPerfilDto) {
    const cambios: Partial<User> = {};
    if (dto.nombre !== undefined) cambios.nombre = dto.nombre;
    if (dto.telefono !== undefined) cambios.telefono = vacioANull(dto.telefono);
    if (dto.cargo !== undefined) cambios.cargo = vacioANull(dto.cargo);
    if (Object.keys(cambios).length) await this.users.update(userId, cambios);
    return this.perfil(userId);
  }

  async cambiarCorreo(userId: number, dto: CambiarCorreoDto) {
    const email = dto.email.toLowerCase();
    await this.verificarContrasena(userId, dto.contrasenaActual);
    const otro = await this.users.findOne({ where: { email } });
    if (otro && otro.id !== userId) {
      throw new ConflictException('Ese correo ya está en uso por otra cuenta');
    }
    await this.users.update(userId, { email });
    return this.perfil(userId);
  }

  async cambiarContrasena(userId: number, dto: CambiarContrasenaDto) {
    await this.verificarContrasena(userId, dto.actual);
    if (dto.nueva === dto.actual) {
      throw new BadRequestException(
        'La nueva contraseña debe ser distinta de la actual',
      );
    }
    await this.users.update(userId, {
      contrasena: await bcrypt.hash(dto.nueva, 10),
      contrasenaActualizada: new Date(),
    });
    return this.perfil(userId);
  }

  async guardarAvatar(userId: number, imagen: string | null) {
    await this.users.update(userId, { avatar: imagen });
    return this.perfil(userId);
  }

  async empresa(personaId: number): Promise<Empresa> {
    const p = await this.personas
      .createQueryBuilder('p')
      .addSelect('p.logo')
      .where('p.id = :personaId', { personaId })
      .getOne();
    if (!p) throw new NotFoundException('Empresa no encontrada');
    return {
      id: p.id,
      razonSocial: p.razonSocial || p.nombreEmpresa,
      nombreComercial: p.nombreEmpresa,
      ruc: p.ruc,
      direccion: p.direccion ?? null,
      telefono: p.telefono ?? null,
      logo: p.logo ?? null,
    };
  }

  async actualizarEmpresa(personaId: number, dto: ActualizarEmpresaDto) {
    const actual = await this.empresa(personaId);
    const cambios: Partial<Persona> = {};
    if (dto.razonSocial !== undefined) cambios.razonSocial = dto.razonSocial;
    if (dto.direccion !== undefined) cambios.direccion = dto.direccion;
    if (dto.telefono !== undefined) cambios.telefono = dto.telefono;
    // nombreEmpresa es obligatorio: sin nombre comercial se usa la razón social
    if (dto.nombreComercial !== undefined) {
      cambios.nombreEmpresa =
        dto.nombreComercial || dto.razonSocial || actual.razonSocial;
    }
    if (Object.keys(cambios).length)
      await this.personas.update(personaId, cambios);
    return this.empresa(personaId);
  }

  async guardarLogo(personaId: number, imagen: string | null) {
    await this.personas.update(personaId, { logo: imagen });
    return this.empresa(personaId);
  }

  private async verificarContrasena(userId: number, contrasena: string) {
    const u = await this.users.findOne({ where: { id: userId } });
    if (!u || !(await bcrypt.compare(contrasena, u.contrasena))) {
      throw new BadRequestException('La contraseña actual no es correcta');
    }
  }
}
