import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class AuthLoginDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  email: string;
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  contrasena: string;
}
