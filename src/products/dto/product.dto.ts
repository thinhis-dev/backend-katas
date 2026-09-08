import { IsInt, IsPositive } from 'class-validator'

export class PurchaseDto {
  @IsInt()
  @IsPositive()
  quantity: number
}
