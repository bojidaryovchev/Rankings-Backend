import * as moment from 'moment';
import { AgeCategory, Gender } from 'shared/enums';
import { AgeCategoryUtility } from 'shared/enums/enums-utility';
import { Utils } from 'shared/utils';

export class AthleteDetail {
  public readonly id: string;
  public readonly name: string;
  public readonly surname: string;
  public readonly profileUrl: string;
  public readonly gender: Gender;
  public readonly country: string;
  public readonly birthdate: Date;
  public readonly email: string;
  public readonly city: string;
  public readonly infoUrl: string;
  public readonly createdAt?: number;

  public get ageCategory(): AgeCategory {
    const birthYear = Utils.dateToMoment(this.birthdate).year();
    const age =
      moment()
        .utc()
        .year() - birthYear;
    return AgeCategoryUtility.getAgeCategoryOfAge(age);
  }

  constructor({
    id,
    name,
    surname,
    profileUrl,
    gender,
    country,
    birthdate,
    email,
    city,
    infoUrl,
    createdAt,
  }: {
    id: string;
    name: string;
    surname: string;
    profileUrl: string;
    gender: Gender;
    country: string;
    birthdate: Date;
    email: string;
    city: string;
    infoUrl: string;
    createdAt?: number;
  }) {
    this.id = id;
    this.name = name;
    this.surname = surname;
    this.profileUrl = profileUrl;
    this.gender = gender;
    this.country = country;
    this.birthdate = birthdate;
    this.email = email;
    this.city = city;
    this.infoUrl = infoUrl;
    this.createdAt = createdAt;
  }
}
