import { IsInt, IsPositive, IsUUID } from 'class-validator'

export class TransferDto {
  @IsUUID()
  toAccountId: string

  @IsInt()
  @IsPositive()
  amountCents: number
}
